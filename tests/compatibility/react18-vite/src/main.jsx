import { StrictMode, version } from 'react';
import { createRoot } from 'react-dom/client';
import { Fixture } from './fixture.jsx';

if (version !== '18.3.1') {
  throw new Error(`Expected React 18.3.1, received ${version}.`);
}

const root = document.getElementById('root');
if (!root) throw new Error('React 18 compatibility fixture root was not found.');

createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
