declare module "bz2" {
  export function decompress(data: Uint8Array, crc?: boolean): Uint8Array;
}
