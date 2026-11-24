import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../src/App";
import { Alerts } from "../src/pages/Alerts";
import { useTelemetry } from "../src/hooks/useTelemetry";
import { api, control } from "../src/services/api";
vi.mock("../src/hooks/useTelemetry", () => ({ useTelemetry: vi.fn() }));
vi.mock("../src/components/TelemetryChart", () => ({
  TelemetryChart: () => <div>Live chart</div>,
  METRICS: { temperature: { label: "Temperature", unit: "°C" } },
}));
vi.mock("../src/services/api", async (importOriginal) => ({
  ...(await importOriginal()),
  api: vi.fn(),
  control: vi.fn(),
}));
const state = {
  readings: [],
  latest: [],
  machines: [{ id: "MCH-001", name: "Atlas Press", location: "A" }],
  thresholds: [],
  stats: { active_alerts: 0 },
  alerts: [],
  loading: false,
  status: "live",
  error: "",
  paused: false,
  setPaused: vi.fn(),
  refresh: vi.fn(),
};
beforeEach(() => {
  useTelemetry.mockReturnValue(state);
  api.mockResolvedValue({ data: [] });
  control.mockResolvedValue({ data: { status: "acknowledged" } });
});
describe("dashboard interactions", () => {
  it("renders the dashboard and changes global machine scope", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Operations overview" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Global machine selector"), {
      target: { value: "MCH-001" },
    });
    expect(useTelemetry).toHaveBeenLastCalledWith("MCH-001", "1h");
  });
  it("renders loading and error states", () => {
    useTelemetry.mockReturnValue({
      ...state,
      loading: true,
      error: "Service temporarily unavailable",
    });
    render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Service temporarily unavailable",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading persisted telemetry",
    );
  });
  it("navigates to pipeline health and toggles theme", () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Pipeline Health", exact: true }),
    );
    expect(
      screen.getByRole("heading", { name: "Pipeline diagnostics" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Use light theme"));
    expect(screen.getByLabelText("Use dark theme")).toBeInTheDocument();
  });
  it("acknowledges a real alert through the control API", async () => {
    api.mockResolvedValue({
      data: [
        {
          id: "1",
          machine_id: "MCH-001",
          metric: "temperature",
          observed_value: 99,
          threshold_value: 95,
          severity: "critical",
          status: "active",
          created_at: new Date().toISOString(),
        },
      ],
    });
    render(<Alerts machine="" token="test-token" />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Acknowledge" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() =>
      expect(control).toHaveBeenCalledWith(
        "/alerts/1/acknowledge",
        "PATCH",
        null,
        "test-token",
      ),
    );
  });
});
