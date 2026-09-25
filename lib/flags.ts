/**
 * Hand evaluation (`POST /api/play/evaluate`). Off unless the build has
 * `NEXT_PUBLIC_HAND_EVAL=1`.
 */
export const handEvalEnabled = process.env.NEXT_PUBLIC_HAND_EVAL === "1";
