/**
 * Convierte un archivo de imagen a un data URL reducido (webp), para poder mandarlo por el mesh
 * de ZeroTier sin depender de ningún servicio de almacenamiento. Un avatar de 256px pesa unos
 * pocos KB, así que entra sin problema en el mensaje de presencia.
 */
export async function fileToRawDataUrl(file: File): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

export async function fileToDataUrl(file: File, maxDimension: number, quality = 0.85): Promise<string> {
	const original = await fileToRawDataUrl(file);

	const image = await new Promise<HTMLImageElement>((resolve, reject) => {
		const element = new Image();
		element.onload = () => resolve(element);
		element.onerror = reject;
		element.src = original;
	});

	const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
	const width = Math.max(1, Math.round(image.width * scale));
	const height = Math.max(1, Math.round(image.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) return original;
	context.drawImage(image, 0, 0, width, height);
	try {
		return canvas.toDataURL('image/webp', quality);
	} catch {
		return canvas.toDataURL('image/jpeg', quality);
	}
}
