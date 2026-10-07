declare module 'marks-pane' {
  // Only the part the reader touches: the shapes a highlight is drawn from.
  export class Mark {
    range: Range
    filteredRanges(): Array<{ left: number; top: number; width: number; height: number }>
  }
}
