import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@gridstory/example-kit/styles.css';
import { App } from './App';
import './styles/studio.scss';

const root = document.getElementById('root');
if (!root) throw new Error('GridStory Studio root element was not found.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
