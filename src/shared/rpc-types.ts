import type { RPCSchema } from "electrobun/bun";

export type MdviewRPC = {
  bun: RPCSchema<{
    requests: {
      readFile: {
        params: { path: string };
        response: { content: string; path: string; dir: string };
      };
      getInitialFile: {
        params: {};
        response: string | null;
      };
      findProjectRoot: {
        params: { filePath: string };
        response: string | null;
      };
      revealInFinder: {
        params: { filePath: string };
        response: void;
      };
      copyToClipboard: {
        params: { text: string };
        response: void;
      };
      showOpenDialog: {
        params: {};
        response: string | null;
      };
      openExternal: {
        params: { url: string };
        response: void;
      };
      isMdAssociated: {
        params: {};
        response: boolean;
      };
      setMdAssociation: {
        params: { enable: boolean };
        response: boolean;
      };
    };
    messages: {
      syncFontMenu: { fontId: string };
      setFileMenuEnabled: { enabled: boolean };
      setWindowTitle: { title: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      openFile: { filePath: string };
      setFont: { fontId: string };
      menuAction: { action: string };
      showError: { message: string };
      cliInstallResult: { result: string };
    };
  }>;
};
