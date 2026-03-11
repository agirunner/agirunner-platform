import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

import { App } from './app/app.js';
import { readTheme } from './app/theme.js';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry auth errors — withRefresh handles token refresh
        if (String(error).includes('401')) return false;
        return failureCount < 1;
      },
    },
  },
});

createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster position="bottom-right" theme={readTheme()} />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
