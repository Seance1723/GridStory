import {
  context,
  metrics,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Counter,
  type Context,
  type Span,
  type TextMapGetter,
  type Histogram,
} from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  METRIC_HTTP_SERVER_REQUEST_DURATION,
} from '@opentelemetry/semantic-conventions';
import type { ContentScope, TenantTelemetryEvent, TenantTelemetrySink } from '@gridstory/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ObservabilityConfig } from './config.js';

type ComponentStatus = 'degraded' | 'disabled' | 'healthy' | 'stopped' | 'unknown';

export interface ObservabilityHealth {
  enabled: boolean;
  status: ComponentStatus;
  signals: {
    logs: ComponentStatus;
    metrics: ComponentStatus;
    traces: ComponentStatus;
  };
  collector: {
    status: ComponentStatus;
    checkedAt?: string;
    reason?: 'healthcheck_not_configured' | 'collector_unhealthy' | 'collector_unreachable';
  };
  logSdk: 'development';
}

export interface GridStoryObservability {
  tenantTelemetry: TenantTelemetrySink;
  registerFastify(server: FastifyInstance): void;
  health(): Promise<ObservabilityHealth>;
  runWorkerScope<T>(scope: ContentScope, operation: () => Promise<T>): Promise<T>;
  shutdown(): Promise<void>;
}

interface RequestObservation {
  context: Context;
  span: Span;
  startedAt: number;
  errorType?: string;
}

type HealthFetcher = (
  input: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean }>;

type CollectorHealth = ObservabilityHealth['collector'];

const headerGetter: TextMapGetter<Record<string, string | string[] | undefined>> = {
  get(carrier, key) {
    return carrier[key.toLowerCase()];
  },
  keys(carrier) {
    return Object.keys(carrier);
  },
};

function safeRoute(value: string | undefined): string {
  if (!value?.startsWith('/') || value.length > 200) return 'unmatched';
  return value;
}

function safeErrorType(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(code)) return code;
  }
  return 'internal_error';
}

export function tenantScopeAttributes(scope: ContentScope): Attributes {
  return {
    'gridstory.organization.id': scope.organizationId,
    'gridstory.tenant.id': scope.tenantId,
    'gridstory.workspace.id': scope.workspaceId,
    'gridstory.site.id': scope.siteId,
    'gridstory.environment.id': scope.environmentId,
    'gridstory.locale': scope.locale,
  };
}

export function tenantTelemetryAttributes(event: TenantTelemetryEvent): {
  record: Attributes;
  metric: Attributes;
} {
  const metadata = Object.fromEntries(
    Object.entries(event.metadata ?? {}).map(([key, value]) => [
      `gridstory.event.metadata.${key}`,
      value,
    ]),
  );
  return {
    record: {
      ...tenantScopeAttributes(event),
      'gridstory.event.name': event.name,
      'gridstory.event.outcome': event.outcome,
      ...(event.operationId ? { 'gridstory.operation.id': event.operationId } : {}),
      ...(event.subjectId ? { 'gridstory.subject.id': event.subjectId } : {}),
      ...metadata,
    },
    metric: {
      'gridstory.event.name': event.name,
      'gridstory.event.outcome': event.outcome,
    },
  };
}

export async function probeCollector(
  healthCheckUrl: string,
  healthTimeoutMs: number,
  fetcher: HealthFetcher,
): Promise<CollectorHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetcher(healthCheckUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(healthTimeoutMs),
    });
    return response.ok
      ? { status: 'healthy', checkedAt }
      : { status: 'degraded', checkedAt, reason: 'collector_unhealthy' };
  } catch {
    return { status: 'degraded', checkedAt, reason: 'collector_unreachable' };
  }
}

class OpenTelemetryRuntime implements GridStoryObservability {
  readonly tenantTelemetry: TenantTelemetrySink;
  readonly #config: ObservabilityConfig;
  readonly #fetcher: HealthFetcher;
  readonly #sdk: NodeSDK | undefined;
  readonly #requests = new WeakMap<FastifyRequest, RequestObservation>();
  readonly #tenantEvents: Counter | undefined;
  readonly #workerDuration: Histogram | undefined;
  #state: 'disabled' | 'healthy' | 'stopped';

  constructor(config: ObservabilityConfig, fetcher: HealthFetcher) {
    this.#config = config;
    this.#fetcher = fetcher;
    this.#state = config.enabled ? 'healthy' : 'disabled';
    this.tenantTelemetry = config.enabled ? (event) => this.#recordTenantEvent(event) : () => {};
    if (!config.enabled) return;

    this.#sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
        ...(config.serviceVersion ? { [ATTR_SERVICE_VERSION]: config.serviceVersion } : {}),
      }),
      traceExporter: new OTLPTraceExporter(),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: config.metricExportIntervalMs,
          cardinalityLimits: { default: 2_000 },
        }),
      ],
      logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    });
    this.#sdk.start();
    this.#tenantEvents = metrics
      .getMeter('io.gridstory.domain')
      .createCounter('gridstory.tenant.event', {
        description: 'Validated tenant events by bounded event name and outcome.',
      });
    this.#workerDuration = metrics
      .getMeter('io.gridstory.worker')
      .createHistogram('gridstory.worker.scope.duration', {
        description: 'Duration of one tenant-scoped worker cycle.',
        unit: 's',
      });
  }

  registerFastify(server: FastifyInstance): void {
    if (!this.#config.enabled) return;
    const tracer = trace.getTracer('io.gridstory.api');
    const meter = metrics.getMeter('io.gridstory.api');
    const logger = logs.getLogger('io.gridstory.api');
    const duration = meter.createHistogram(METRIC_HTTP_SERVER_REQUEST_DURATION, {
      description: 'Duration of inbound GridStory HTTP requests.',
      unit: 's',
    });
    const errors = meter.createCounter('gridstory.api.request.errors', {
      description: 'Inbound GridStory requests that complete with a server error.',
    });

    server.addHook('onRequest', (request, _reply, done) => {
      const route = safeRoute(request.routeOptions.url);
      const method = request.method.toUpperCase();
      const parent = propagation.extract(context.active(), request.headers, headerGetter);
      const span = tracer.startSpan(
        `${method} ${route}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            [ATTR_HTTP_REQUEST_METHOD]: method,
            [ATTR_HTTP_ROUTE]: route,
            'gridstory.request.id': request.id,
          },
        },
        parent,
      );
      const requestContext = trace.setSpan(parent, span);
      this.#requests.set(request, {
        context: requestContext,
        span,
        startedAt: performance.now(),
      });
      context.with(requestContext, done);
    });

    server.addHook('onError', (request, _reply, error, done) => {
      const observation = this.#requests.get(request);
      if (observation) {
        observation.errorType = safeErrorType(error);
        observation.span.setAttribute(ATTR_ERROR_TYPE, observation.errorType);
      }
      done();
    });

    server.addHook('onResponse', (request, reply, done) => {
      const observation = this.#requests.get(request);
      if (!observation) {
        done();
        return;
      }
      const elapsedSeconds = Math.max(0, performance.now() - observation.startedAt) / 1_000;
      const route = safeRoute(request.routeOptions.url);
      const method = request.method.toUpperCase();
      const statusCode = reply.statusCode;
      const attributes: Attributes = {
        [ATTR_HTTP_REQUEST_METHOD]: method,
        [ATTR_HTTP_ROUTE]: route,
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
        ...(observation.errorType ? { [ATTR_ERROR_TYPE]: observation.errorType } : {}),
      };
      observation.span.updateName(`${method} ${route}`);
      observation.span.setAttributes(attributes);
      if (statusCode >= 500) {
        const errorType = observation.errorType ?? `${statusCode}`;
        attributes[ATTR_ERROR_TYPE] = errorType;
        observation.span.setAttribute(ATTR_ERROR_TYPE, errorType);
        observation.span.setStatus({ code: SpanStatusCode.ERROR });
        errors.add(1, attributes, observation.context);
      } else if (statusCode < 400) {
        observation.span.setStatus({ code: SpanStatusCode.OK });
      }
      duration.record(elapsedSeconds, attributes, observation.context);
      logger.emit({
        eventName: 'gridstory.http.request.completed',
        body: 'GridStory HTTP request completed.',
        context: observation.context,
        severityNumber:
          statusCode >= 500
            ? SeverityNumber.ERROR
            : statusCode >= 400
              ? SeverityNumber.WARN
              : SeverityNumber.INFO,
        severityText: statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO',
        attributes: {
          ...attributes,
          'gridstory.request.id': request.id,
        },
      });
      observation.span.end();
      this.#requests.delete(request);
      done();
    });
  }

  async health(): Promise<ObservabilityHealth> {
    if (!this.#config.enabled || this.#state === 'disabled') return disabledHealth();
    if (this.#state === 'stopped') {
      return {
        enabled: true,
        status: 'stopped',
        signals: { logs: 'stopped', metrics: 'stopped', traces: 'stopped' },
        collector: { status: 'unknown', reason: 'healthcheck_not_configured' },
        logSdk: 'development',
      };
    }
    if (!this.#config.healthCheckUrl) {
      return {
        enabled: true,
        status: 'healthy',
        signals: { logs: 'healthy', metrics: 'healthy', traces: 'healthy' },
        collector: { status: 'unknown', reason: 'healthcheck_not_configured' },
        logSdk: 'development',
      };
    }
    const collector = await probeCollector(
      this.#config.healthCheckUrl,
      this.#config.healthTimeoutMs,
      this.#fetcher,
    );
    return {
      enabled: true,
      status: collector.status === 'healthy' ? 'healthy' : 'degraded',
      signals: { logs: 'healthy', metrics: 'healthy', traces: 'healthy' },
      collector,
      logSdk: 'development',
    };
  }

  async runWorkerScope<T>(scope: ContentScope, operation: () => Promise<T>): Promise<T> {
    if (!this.#config.enabled) return operation();
    const tracer = trace.getTracer('io.gridstory.worker');
    const startedAt = performance.now();
    return tracer.startActiveSpan(
      'gridstory.worker.scope',
      { kind: SpanKind.CONSUMER, attributes: tenantScopeAttributes(scope) },
      async (span) => {
        try {
          const result = await operation();
          span.setStatus({ code: SpanStatusCode.OK });
          this.#workerDuration?.record(Math.max(0, performance.now() - startedAt) / 1_000, {
            'gridstory.worker.outcome': 'success',
          });
          return result;
        } catch (error) {
          const errorType = safeErrorType(error);
          span.setAttribute(ATTR_ERROR_TYPE, errorType);
          span.setStatus({ code: SpanStatusCode.ERROR });
          this.#workerDuration?.record(Math.max(0, performance.now() - startedAt) / 1_000, {
            'gridstory.worker.outcome': 'error',
            [ATTR_ERROR_TYPE]: errorType,
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  async shutdown(): Promise<void> {
    if (!this.#sdk || this.#state === 'stopped') return;
    try {
      await this.#sdk.shutdown();
    } finally {
      this.#state = 'stopped';
    }
  }

  #recordTenantEvent(event: TenantTelemetryEvent): void {
    const attributes = tenantTelemetryAttributes(event);
    const activeContext = context.active();
    const activeSpan = trace.getSpan(activeContext);
    activeSpan?.addEvent(event.name, attributes.record, new Date(event.occurredAt));
    this.#tenantEvents?.add(1, attributes.metric, activeContext);
    logs.getLogger('io.gridstory.domain').emit({
      eventName: event.name,
      body: 'GridStory tenant operation event.',
      timestamp: new Date(event.occurredAt),
      context: activeContext,
      severityNumber:
        event.outcome === 'error'
          ? SeverityNumber.ERROR
          : event.outcome === 'denied'
            ? SeverityNumber.WARN
            : SeverityNumber.INFO,
      severityText:
        event.outcome === 'error' ? 'ERROR' : event.outcome === 'denied' ? 'WARN' : 'INFO',
      attributes: attributes.record,
    });
  }
}

function disabledHealth(): ObservabilityHealth {
  return {
    enabled: false,
    status: 'disabled',
    signals: { logs: 'disabled', metrics: 'disabled', traces: 'disabled' },
    collector: { status: 'disabled' },
    logSdk: 'development',
  };
}

export function startObservability(
  config: ObservabilityConfig,
  fetcher: HealthFetcher = (input, init) => fetch(input, init),
): GridStoryObservability {
  return new OpenTelemetryRuntime(config, fetcher);
}
