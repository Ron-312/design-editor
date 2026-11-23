import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  readonly area: string
  readonly children: ReactNode
}

interface ErrorBoundaryState {
  readonly error: Error | null
}

/** Keeps one crashed area from unmounting the whole editor; Retry renders it again. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.area} crashed: ${error.message}`, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crashed" role="alert">
        <p>
          The {this.props.area} hit an error: {error.message}
        </p>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    )
  }
}
