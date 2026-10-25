/** Shrinks a camera photo to a JPEG at most `maxSide` px on its long side, so it uploads fast on campus Wi-Fi.
 * Returns base64 without the data: prefix. */
export async function toJpegBase64(file: File, maxSide = 1280) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
}
