export interface BootstrapResponse {
  product: "Northstar CRM";
  status: "ready";
}

export interface ErrorResponse {
  error: { code: string; message: string; requestId: string };
}
