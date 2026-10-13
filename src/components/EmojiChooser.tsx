import {memo, useCallback, useEffect, useState} from 'react';
import EmojiPicker, {EmojiStyle, Theme, type EmojiClickData} from 'emoji-picker-react';
import type {EmojiData} from 'emoji-picker-react/dist/types/exposedTypes';
import {useStore} from '@/state/store';

/**
 * Datos de emojis en español, cargados una sola vez (promesa cacheada a nivel de módulo).
 *
 * Ojo con la ruta: en la v4 los archivos viven en `dist/data/`. El resultado se guarda porque el
 * prop `emojiData` de la v4 quiere el objeto ya resuelto (no una promesa).
 */
let spanishEmojiData: Promise<EmojiData> | null = null;
const loadSpanishEmojiData = (): Promise<EmojiData> => {
	spanishEmojiData ??= import('emoji-picker-react/dist/data/emojis-es').then(
		(mod) => (mod.default ?? mod) as unknown as EmojiData,
	);
	return spanishEmojiData;
};

const PREVIEW_CONFIG = {showPreview: false};

/**
 * El picker es pesado (miles de emojis). Se memoiza para que NO se vuelva a renderizar cuando el
 * store cambia (presencia, mensajes, etc.).
 *
 * Se usa la v4 a propósito: la v5.0.0 (la última) renderiza los emojis de a tandas de 64 y el
 * resto queda en blanco reservando miles de píxeles de alto, así que el selector se veía vacío
 * y trababa al scrollear.
 */
const MemoEmojiPicker = memo(EmojiPicker);

export function EmojiChooser({
	onSelect,
	onClose,
}: {
	onSelect: (emoji: string) => void;
	onClose: () => void;
}): JSX.Element {
	const {state} = useStore();
	const theme = state.settings.theme === 'light' ? Theme.LIGHT : Theme.DARK;
	const [emojiData, setEmojiData] = useState<EmojiData | null>(null);

	useEffect(() => {
		let activo = true;
		void loadSpanishEmojiData().then((data) => {
			if (activo) setEmojiData(data);
		});
		return () => {
			activo = false;
		};
	}, []);

	const handleEmojiClick = useCallback((data: EmojiClickData) => onSelect(data.emoji), [onSelect]);

	return (
		<>
			<div className="emoji-backdrop" onClick={onClose} />
			<div className="emoji-popover" onClick={(event) => event.stopPropagation()}>
				{emojiData ? (
					<MemoEmojiPicker
						emojiData={emojiData}
						emojiStyle={EmojiStyle.NATIVE}
						theme={theme}
						width={352}
						height={352}
						autoFocusSearch
						previewConfig={PREVIEW_CONFIG}
						searchPlaceholder="Buscar emoji…"
						onEmojiClick={handleEmojiClick}
					/>
				) : (
					<div className="emoji-loading">Cargando emojis…</div>
				)}
			</div>
		</>
	);
}
