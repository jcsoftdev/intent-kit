export interface AssistantCopy {
  askAssistant(query: string): string;
  heard(transcript: string): string;
  confirm: string;
  decline: string;
  listening: string;
  holdToTalk: string;
  cloudNotice: { title: string; body: string; accept: string; decline: string };
  undo: string;
  clarifyTitle(prompt: string): string;
}
