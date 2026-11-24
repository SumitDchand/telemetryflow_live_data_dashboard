import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useTelemetry,
  mergeReadings,
  reconnectDelay,
} from "../src/hooks/useTelemetry";
import { api } from "../src/services/api";
vi.mock("../src/services/api", () => ({
  api: vi.fn(),
  params: (v) =>
    new URLSearchParams(Object.entries(v).filter(([, v]) => v)).toString(),
}));
const reading = (id, temp = 50) => ({
  id: String(id),
  event_id: `event-${id}`,
  machine_id: "MCH-001",
  temperature: temp,
  recorded_at: new Date(1700000000000 + id * 1000).toISOString(),
});
class Socket {
  static instances = [];
  constructor() {
    Socket.instances.push(this);
    this.send = vi.fn();
  }
  close() {
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  message(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  api.mockImplementation(async (path) =>
    path.startsWith("/bootstrap")
      ? {
          data: {
            cursor: "1",
            readings: [reading(1)],
            latest: [reading(1)],
            machines: [],
            thresholds: [],
          },
        }
      : path.startsWith("/alerts")
        ? { data: [] }
        : { data: { successful_writes: 1 } },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("live state", () => {
  it("deduplicates and bounds out of order readings", () => {
    expect(
      mergeReadings([reading(2), reading(1)], [reading(2), reading(3)], 2).map(
        (r) => r.id,
      ),
    ).toEqual(["2", "3"]);
  });
  it("caps exponential reconnect delay", () => {
    expect(reconnectDelay(0)).toBe(1000);
    expect(reconnectDelay(20)).toBe(30000);
  });
  it("loads history, subscribes from snapshot, then renders live data", async () => {
    const { result } = renderHook(() => useTelemetry("MCH-001", "1h"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ws = Socket.instances[0];
    act(() => ws.open());
    expect(JSON.parse(ws.send.mock.calls[0][0]).cursor).toBe("1");
    act(() =>
      ws.message({
        type: "telemetry_update",
        cursor: "2",
        data: [reading(2, 95)],
      }),
    );
    await waitFor(() => expect(result.current.readings).toHaveLength(2));
    expect(result.current.status).toBe("live");
  });
  it("keeps collection bounded while paused and resumes", async () => {
    const { result } = renderHook(() => useTelemetry("", "1h"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPaused(true));
    act(() =>
      Socket.instances[0].message({
        type: "telemetry_update",
        cursor: "2",
        data: [reading(2)],
      }),
    );
    expect(result.current.readings).toHaveLength(1);
    act(() => result.current.setPaused(false));
    expect(result.current.readings).toHaveLength(2);
  });
  it("reports failure and schedules reconnect", async () => {
    const { result } = renderHook(() => useTelemetry("", "1h"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() => Socket.instances[0].close());
    expect(result.current.status).toBe("reconnecting");
    await act(async () => vi.advanceTimersByTime(1300));
    expect(Socket.instances).toHaveLength(2);
  });
  it("exposes loading and bootstrap errors", async () => {
    api.mockRejectedValue(new Error("Database unavailable"));
    const { result } = renderHook(() => useTelemetry("", "1h"));
    expect(result.current.loading).toBe(true);
    await waitFor(() =>
      expect(result.current.error).toBe("Database unavailable"),
    );
    expect(result.current.status).toBe("reconnecting");
  });
});
