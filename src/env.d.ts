declare namespace App {
  interface Locals {
    user: import('./lib/auth').SessionUser | null;
    /** Name of the API token used, when the request was authenticated with a bearer token. */
    apiToken: string | null;
  }
}
