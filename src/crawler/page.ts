/** One step of an interaction sequence: the accessibility node that was clicked. */
export interface Interaction {
  name: string;
  role: string;
}

/** A URL path served by an Instance. */
export interface Page {
  path: string;
}

/** A Page plus the interactions that reach a non-navigating UI state, such as an open modal. */
export interface PageState {
  interactions: Interaction[];
  path: string;
}
