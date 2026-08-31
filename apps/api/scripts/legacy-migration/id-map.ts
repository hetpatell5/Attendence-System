/** In-memory maps from legacy MySQL integer ids to newly-created Postgres uuids. */
export class IdMap {
  readonly shifts = new Map<number, string>();
  readonly employees = new Map<number, string>();
}
