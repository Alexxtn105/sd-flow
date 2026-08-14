import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import i18n from '../../../locales/i18n';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('ErrorBoundary:', error, info.componentStack);
    }

    handleReset = (): void => {
        this.setState({ hasError: false });
    };

    render(): ReactNode {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="error-boundary">
                <p>{i18n.t('errorBoundary.message')}</p>
                <button className="error-boundary-btn" onClick={this.handleReset}>
                    {i18n.t('errorBoundary.retry')}
                </button>
            </div>
        );
    }
}
