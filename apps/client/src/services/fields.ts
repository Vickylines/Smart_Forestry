// uni-app blur events include the final input value, including a throttled last keystroke.
export function fieldValue(event: unknown): string {
  const value=(event as {detail?:{value?:unknown}})?.detail?.value;
  return typeof value==='string'?value:'';
}
