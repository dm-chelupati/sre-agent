import {
  shutdownAzureMonitor,
  useAzureMonitor,
} from "@azure/monitor-opentelemetry";
import { metrics, trace } from "@opentelemetry/api";

let initialized = false;
let azureMonitorEnabled = false;

export function initializeTelemetry(serviceName: string): void {
  if (initialized) {
    return;
  }

  process.env.OTEL_SERVICE_NAME ??= serviceName;
  if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    useAzureMonitor();
    azureMonitorEnabled = true;
  }
  initialized = true;
}

export async function shutdownTelemetry(): Promise<void> {
  if (azureMonitorEnabled) {
    await shutdownAzureMonitor();
    azureMonitorEnabled = false;
  }
}

export function getTracer(component: string) {
  return trace.getTracer(`caldova.${component}`);
}

export function getMeter(component: string) {
  return metrics.getMeter(`caldova.${component}`);
}
