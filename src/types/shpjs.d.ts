declare module "shpjs" {
  const shp: (source: ArrayBuffer | ArrayBufferView) => Promise<unknown>;
  export default shp;
}
