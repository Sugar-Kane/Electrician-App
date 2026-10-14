/**
 * A model reply that stopped at its length limit rather than finishing. What
 * it wrote is incomplete, so it is never kept as the list.
 */
export class ReplyCutOff extends Error {
  constructor() {
    super("The reply reached its length limit before it was finished.");
  }
}
