import { version } from 'react';
import { renderToString } from 'react-dom/server';
import { Fixture } from './fixture.jsx';

if (version !== '18.3.1') {
  throw new Error(`Expected React 18.3.1 during SSR, received ${version}.`);
}

const html = renderToString(<Fixture />);
if (html !== '<h1>GridStory on React 18.3</h1>') {
  throw new Error(`Unexpected React 18 server rendering: ${html}`);
}

console.log(`React ${version} SSR certification passed.`);
