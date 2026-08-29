import type { ConfigurationInventory } from '@gridstory/client';
import type { StudioDestination } from './navigation.js';

type ConfigurationInventoryProps = {
  inventory: ConfigurationInventory | null;
  loading: boolean;
  error: string | null;
  canNavigate: (destination: StudioDestination) => boolean;
  onNavigate: (destination: StudioDestination) => void;
  onRetry: () => Promise<void>;
};

function ownership(value: 'code' | 'operator' | 'editor'): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}-owned · read-only`;
}

function bytes(value: number): string {
  return `${new Intl.NumberFormat('en').format(value)} bytes`;
}

function Unavailable({ children }: { children: string }) {
  return (
    <div className="configuration-inventory__unavailable">
      <strong>Unavailable with current access</strong>
      <p>{children}</p>
    </div>
  );
}

export function ConfigurationInventoryView({
  inventory,
  loading,
  error,
  canNavigate,
  onNavigate,
  onRetry,
}: ConfigurationInventoryProps) {
  const context = inventory?.sections.localesAndEnvironments;
  const models = inventory?.sections.modelsAndRoutes;
  const media = inventory?.sections.mediaPolicyAndProviders;
  return (
    <section className="configuration-inventory" aria-label="Configuration inventory">
      <header className="section-heading configuration-inventory__heading">
        <div>
          <span className="kicker">Settings</span>
          <h2>Effective configuration</h2>
          <p>
            Review the permitted runtime facts that shape this Studio context. This inventory is
            read-only and never exposes credentials, endpoints, or raw environment values.
          </p>
        </div>
        <span className="configuration-inventory__badge">Read-only inventory</span>
      </header>

      {loading ? (
        <p className="configuration-inventory__state" role="status">
          Loading effective configuration…
        </p>
      ) : null}
      {error ? (
        <div
          className="configuration-inventory__state configuration-inventory__state--error"
          role="alert"
        >
          <div>
            <strong>Configuration inventory is unavailable.</strong>
            <p>{error}</p>
          </div>
          <button className="button button--secondary" type="button" onClick={() => void onRetry()}>
            Retry configuration
          </button>
        </div>
      ) : null}

      {!loading && !error && inventory ? (
        <div className="configuration-inventory__sections">
          <article className="configuration-inventory__section">
            <header>
              <div>
                <span className="kicker">Context</span>
                <h3>Sites, environments, and locales</h3>
              </div>
              {context?.availability === 'available' ? (
                <span className="configuration-inventory__ownership">
                  {ownership(context.ownership)}
                </span>
              ) : null}
            </header>
            {context?.availability === 'available' ? (
              <>
                <p className="configuration-inventory__boundary">
                  {context.coverage === 'configured'
                    ? 'Configured coverage includes only choices permitted for this site.'
                    : 'Current-only coverage; no wider environment topology is declared.'}
                </p>
                <dl className="configuration-inventory__facts">
                  <div>
                    <dt>Current site</dt>
                    <dd>
                      {context.current.site.label}
                      <small>{context.current.site.id}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Current environment</dt>
                    <dd>
                      {context.current.environment.label}
                      <small>
                        {context.current.environment.id} ·{' '}
                        {context.current.environment.kind.replace('-', ' ')}
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>Current locale</dt>
                    <dd>
                      {context.current.locale.label}
                      <small>
                        {context.current.locale.code} ·{' '}
                        {context.current.locale.default ? 'default' : 'additional'} ·{' '}
                        {context.current.locale.required ? 'required' : 'optional'}
                      </small>
                    </dd>
                  </div>
                </dl>
                <div className="configuration-inventory__lists">
                  <section aria-labelledby="configuration-environments-heading">
                    <h4 id="configuration-environments-heading">
                      Permitted environments ({context.environments.length})
                    </h4>
                    <ul>
                      {context.environments.map((environment) => (
                        <li key={environment.id}>
                          <strong>{environment.label}</strong>
                          <code>{environment.id}</code>
                          <small>{environment.kind.replace('-', ' ')}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section aria-labelledby="configuration-locales-heading">
                    <h4 id="configuration-locales-heading">
                      Permitted locales ({context.locales.length})
                    </h4>
                    <ul>
                      {context.locales.map((locale) => (
                        <li key={locale.code}>
                          <strong>{locale.label}</strong>
                          <code>{locale.code}</code>
                          <small>
                            prefix {locale.routePrefix || '/'} · fallbacks{' '}
                            {locale.fallbackLocales.join(', ') || 'none'}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </>
            ) : (
              <Unavailable>
                Environment and locale facts require access to platform locale metadata.
              </Unavailable>
            )}
          </article>

          <article className="configuration-inventory__section">
            <header>
              <div>
                <span className="kicker">Content model</span>
                <h3>Models and public routes</h3>
              </div>
              {models?.availability === 'available' ? (
                <span className="configuration-inventory__ownership">
                  {ownership(models.ownership)}
                </span>
              ) : null}
            </header>
            {models?.availability === 'available' ? (
              <>
                <ul className="configuration-inventory__models">
                  {models.models.map((model) => (
                    <li key={model.id}>
                      <div>
                        <strong>{model.name}</strong>
                        <code>
                          {model.id} · v{model.version}
                        </code>
                      </div>
                      <dl>
                        <div>
                          <dt>Collection</dt>
                          <dd>{model.collection}</dd>
                        </div>
                        <div>
                          <dt>Route</dt>
                          <dd>{model.route?.pattern ?? 'Not routed'}</dd>
                        </div>
                        <div>
                          <dt>Localized fields</dt>
                          <dd>{model.localizedFields.join(', ') || 'None'}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
                {canNavigate('schemas') ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => onNavigate('schemas')}
                  >
                    Inspect schemas &amp; taxonomies
                  </button>
                ) : null}
              </>
            ) : (
              <Unavailable>
                Registered model and route facts require schema-read access.
              </Unavailable>
            )}
          </article>

          <article className="configuration-inventory__section">
            <header>
              <div>
                <span className="kicker">Media</span>
                <h3>Policy and provider availability</h3>
              </div>
              {media?.availability === 'available' ? (
                <span className="configuration-inventory__ownership">
                  {ownership(media.ownership)}
                </span>
              ) : null}
            </header>
            {media?.availability === 'available' ? (
              <>
                <dl className="configuration-inventory__facts">
                  <div>
                    <dt>Supported kinds</dt>
                    <dd>{media.policy.supportedKinds.join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Maximum upload</dt>
                    <dd>{bytes(media.policy.maximumUploadBytes)}</dd>
                  </div>
                  <div>
                    <dt>Upload part</dt>
                    <dd>{bytes(media.policy.uploadPartBytes)}</dd>
                  </div>
                  <div>
                    <dt>Image dimension</dt>
                    <dd>{media.policy.maximumDimensionPixels.toLocaleString('en')} px</dd>
                  </div>
                  <div>
                    <dt>Maximum parts</dt>
                    <dd>{media.policy.maximumParts.toLocaleString('en')}</dd>
                  </div>
                  <div>
                    <dt>Delivery and renditions</dt>
                    <dd>Verified assets only</dd>
                  </div>
                </dl>
                <ul className="configuration-inventory__providers">
                  {media.providers.map((provider) => (
                    <li key={provider.kind}>
                      <strong>{provider.kind.replaceAll('-', ' ')}</strong>
                      <span>{provider.mode.replaceAll('-', ' ')}</span>
                      <small>{ownership(provider.ownership)}</small>
                    </li>
                  ))}
                </ul>
                <p className="configuration-inventory__boundary">
                  Configured means an adapter was supplied. It does not certify credentials,
                  connectivity, health, or production readiness.
                </p>
                {canNavigate('assets') ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => onNavigate('assets')}
                  >
                    Open Media library
                  </button>
                ) : null}
              </>
            ) : (
              <Unavailable>Media policy and provider modes require asset-read access.</Unavailable>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}
