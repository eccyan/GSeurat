import React from 'react';
import { componentRegistry } from './ComponentRegistry.js';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ error, errorInfo });
    componentRegistry.reportError('ErrorBoundary', error);
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            padding: '16px 24px',
            background: '#cc0000',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 14,
            zIndex: 99999,
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
            React Error — component tree crashed
          </div>
          <div>{this.state.error.message}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            {this.state.errorInfo?.componentStack?.split('\n').slice(0, 5).join('\n')}
          </div>
          <button
            onClick={() => this.setState({ error: null, errorInfo: null })}
            style={{
              marginTop: 12,
              padding: '4px 12px',
              background: '#fff',
              color: '#cc0000',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Dismiss and retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
