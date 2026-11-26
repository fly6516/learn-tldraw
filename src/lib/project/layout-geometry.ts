export type GeometryMargins = { left: number; right: number; top: number; bottom: number; binding: number }

export type CompiledGeometry = GeometryMargins & { width: number; height: number }

const ptToMm = 25.4 / 72.27
const dimension = '(-?\\d+(?:\\.\\d+)?)pt'

/** geometry writes resolved dimensions to the TeX log even with console verbosity disabled. */
export function readCompiledGeometry(log: string): CompiledGeometry[] {
  return [...log.matchAll(/^\*geometry\* verbose mode - \[[^\]\r\n]+\] result:\s*([\s\S]*?)(?=^\*geometry\* verbose mode|^\s*$|(?![\s\S]))/gm)]
    .flatMap(([, block]) => {
      const horizontal = new RegExp('h-part:\\(L,W,R\\)=\\(' + Array(3).fill(dimension).join(',\\s*') + '\\)').exec(block)
      const vertical = new RegExp('v-part:\\(T,H,B\\)=\\(' + Array(3).fill(dimension).join(',\\s*') + '\\)').exec(block)
      if (!horizontal || !vertical || /disregarded the geometry package/.test(block)) return []
      const [left, width, right] = horizontal.slice(1).map(value => Number(value) * ptToMm)
      const [top, height, bottom] = vertical.slice(1).map(value => Number(value) * ptToMm)
      const binding = Number(new RegExp('bindingoffset:\\s*' + dimension).exec(block)?.[1] ?? 0) * ptToMm
      return [{ left, right, top, bottom, binding, width: left + width + right + binding, height: top + height + bottom }]
    })
}
