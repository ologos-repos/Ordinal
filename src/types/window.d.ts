interface Go {
    app?: {
        App?: {
            FetchOpenRouterModels?: (apiKey: string) => Promise<Array<{id: string, name: string}>>;
            FetchOpenAIModels?: (apiKey: string) => Promise<Array<{id: string, name: string}>>;
            FetchGeminiModels?: (apiKey: string) => Promise<Array<{id: string, name: string}>>;
            FetchOllamaModels?: () => Promise<Array<{id: string, name: string}>>;
            [key: string]: any;
        };
    };
}

interface Window {
    go?: Go;
    __WAILS_RUNTIME__?: any;
    showOpenFilePicker?: (options?: any) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: any) => Promise<FileSystemFileHandle>;
}