import type OpenAI from "openai";

export type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface Entry {
  param: MessageParam;
  seq: number | null;
}
