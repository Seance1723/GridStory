import type { ReactNode } from 'react';
import { createComponentRegistry, type GridStoryComponentProps } from '@gridstory/react';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function Hero({ eyebrow, heading, body, tone }: GridStoryComponentProps): ReactNode {
  return (
    <section className={`gs-hero gs-hero--${text(tone) || 'indigo'}`}>
      <div className="gs-content-width">
        {text(eyebrow) ? <p className="gs-eyebrow">{text(eyebrow)}</p> : null}
        <h1>{text(heading)}</h1>
        <p className="gs-hero__body">{text(body)}</p>
      </div>
    </section>
  );
}

function RichText({ heading, body }: GridStoryComponentProps): ReactNode {
  return (
    <section className="gs-rich-text gs-content-width">
      <h2>{text(heading)}</h2>
      <p>{text(body)}</p>
    </section>
  );
}

function Callout({ heading, body, tone }: GridStoryComponentProps): ReactNode {
  return (
    <aside className={`gs-callout gs-callout--${text(tone) || 'info'} gs-content-width`}>
      <h2>{text(heading)}</h2>
      <p>{text(body)}</p>
    </aside>
  );
}

function Stack({ gap, surface, slots }: GridStoryComponentProps): ReactNode {
  return (
    <section
      className={`gs-stack gs-stack--${text(gap) || 'medium'} gs-stack--${text(surface) || 'plain'}`}
    >
      {slots?.content}
    </section>
  );
}

export const exampleComponentRegistry = createComponentRegistry({
  'gridstory.hero': Hero,
  'gridstory.rich-text': RichText,
  'gridstory.callout': Callout,
  'gridstory.stack': Stack,
});
