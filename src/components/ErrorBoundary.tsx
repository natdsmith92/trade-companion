"use client";

import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  // Label used in the default fallback so we can tell which boundary tripped.
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// React-level error boundary. Required as a class component — React has no hook
// for componentDidCatch. Wrapping each dashboard tab in one means a render bug
// in the Game Plan (e.g. a malformed parsed plan) doesn't blank the whole app.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="error-boundary">
        <div className="error-boundary-title">
          Something broke{this.props.label ? ` in ${this.props.label}` : ""}.
        </div>
        <div className="error-boundary-msg">
          {this.state.error?.message || "Unknown error"}
        </div>
        <button className="btn b-d b-sm" onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
