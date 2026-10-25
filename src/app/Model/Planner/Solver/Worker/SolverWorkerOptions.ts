export interface SolverWorkerOptions
{
	mipRelGap?: number;
	/** Optional engine limit for best-effort factory simplification. */
	timeLimitSeconds?: number;
}
