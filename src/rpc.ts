import type { RPCSchema } from "electrobun";

export type MdviewRPC = {
  bun: RPCSchema<{
    requests: {
      readFile: {
        params: { path: string };
        response: { content: string; filePath: string; dirPath: string };
      };
      openFileDialog: {
        params: {};
        response: { filePath: string | null };
      };
      getSavedFont: {
        params: {};
        response: { font: string };
      };
      saveFont: {
        params: { font: string };
        response: { success: boolean };
      };
      getSavedSize: {
        params: {};
        response: { size: number };
      };
      saveSize: {
        params: { size: number };
        response: { success: boolean };
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {
      exportPDF: {
        params: {};
        response: { pdfBase64: string };
      };
    };
    messages: {
      loadFile: {
        content: string;
        filePath: string;
        dirPath: string;
      };
      setFont: {
        font: string;
      };
      setSize: {
        size: number;
      };
    };
  }>;
};
