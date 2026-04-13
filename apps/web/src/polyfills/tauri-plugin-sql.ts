const Database = {
  async load(): Promise<never> {
    throw new Error('Tauri SQL plugin is unavailable in the browser frontend.');
  },
};

export default Database;
