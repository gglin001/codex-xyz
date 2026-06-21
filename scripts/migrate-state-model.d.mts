export type MigrationOptions = {
  backupPath?: string | false
}

export type MigrationResult = {
  databasePath: string
  backupPath: string | null
  changed: boolean
}

export function migrateStateModel(databasePathInput?: string, options?: MigrationOptions): MigrationResult
