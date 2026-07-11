import React from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
import App from './App';
import '../packages/locale';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
