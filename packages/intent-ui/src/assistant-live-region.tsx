export interface AssistantLiveRegionProps {
  readonly message: string;
}

export function AssistantLiveRegion({ message }: AssistantLiveRegionProps) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
