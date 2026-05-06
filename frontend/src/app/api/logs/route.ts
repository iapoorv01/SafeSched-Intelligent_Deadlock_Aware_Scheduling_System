import { store } from '../store';

export async function GET(params?: { type?: string; limit?: number }) {
  const limit = params?.limit ?? 200;
  const type = params?.type;
  const events = type
    ? store.eventLog.filter(e => e.type === type).slice(0, limit)
    : store.eventLog.slice(0, limit);
  return { events, total: store.eventLog.length };
}
