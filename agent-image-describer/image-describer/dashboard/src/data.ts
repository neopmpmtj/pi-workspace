import { chatKey, imageKey, type ChatPoint, type ImagePoint } from "../parse.ts";
import type { RatesSnapshot } from "./rates.ts";

export const api = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8788";

export interface Rows {
  images: ImagePoint[];
  chat: ChatPoint[];
  rates: RatesSnapshot;
}

export async function loadRows(): Promise<Rows> {
  const [images, chat, rates] = await Promise.all([
    getPoints<ImagePoint>("/api/images"),
    getPoints<ChatPoint>("/api/chat"),
    getRates(),
  ]);
  return { images, chat, rates };
}

export function subscribe(
  rows: Rows,
  onChange: () => void,
  onStatus: (status: string) => void,
): () => void {
  const images = new Set(rows.images.map(imageKey));
  const chats = new Set(rows.chat.map(chatKey));
  const source = new EventSource(`${api}/api/events`);
  source.addEventListener("image", (event) => {
    const point = JSON.parse((event as MessageEvent).data) as ImagePoint;
    if (images.has(imageKey(point))) return;
    images.add(imageKey(point));
    rows.images.push(point);
    onChange();
  });
  source.addEventListener("chat", (event) => {
    const point = JSON.parse((event as MessageEvent).data) as ChatPoint;
    if (chats.has(chatKey(point))) return;
    chats.add(chatKey(point));
    rows.chat.push(point);
    onChange();
  });
  source.onopen = () => onStatus("live");
  source.onerror = () => onStatus("reconnecting");
  return () => source.close();
}

async function getPoints<T>(path: string): Promise<T[]> {
  const response = await fetch(`${api}${path}`);
  if (!response.ok) throw new Error(`Dashboard API ${path} returned ${response.status}.`);
  const body = await response.json() as { points?: T[] };
  return body.points ?? [];
}

async function getRates(): Promise<RatesSnapshot> {
  const response = await fetch(`${api}/api/rates`);
  if (!response.ok) throw new Error(`Dashboard API /api/rates returned ${response.status}.`);
  return await response.json() as RatesSnapshot;
}
