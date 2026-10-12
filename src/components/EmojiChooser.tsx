import EmojiPicker, {EmojiStyle, SkinTonePickerLocation, type EmojiClickData} from 'emoji-picker-react';
import {useStore} from '@/state/store';

/**
 * Carga diferida del set de emojis en español: el picker lo pide recién al abrirse,
 * así los datos (varios cientos de KB) no engordan el bundle principal.
 * Debe quedar a nivel de módulo: una función nueva en cada render vuelve a cargar.
 */
const loadSpanishEmojiData = () => import('emoji-picker-react/data/emojis-es');

/**
 * Selector de emojis completo: todas las categorías, búsqueda y tonos de piel.
 * El tono de piel no se muestra como botón fijo (ese cuadradito confundía): se elige
 * manteniendo apretado un emoji que tenga variantes.
 */
export function EmojiChooser({
	onSelect,
	onClose,
}: {
	onSelect: (emoji: string) => void;
	onClose: () => void;
}): JSX.Element {
	const {state} = useStore();
	return (
		<>
			<div className="emoji-backdrop" onClick={onClose} />
			<div className="emoji-popover" onClick={(event) => event.stopPropagation()}>
				<EmojiPicker
					emojiData={loadSpanishEmojiData}
					emojiStyle={EmojiStyle.NATIVE}
					colorScheme={state.settings.theme === 'light' ? 'light' : 'dark'}
					width={352}
					height={352}
					autoFocusSearch
					lazyLoadEmojis
					skinTonePickerLocation={SkinTonePickerLocation.NONE}
					previewConfig={{showPreview: false}}
					labels={{
						searchPlaceholder: 'Buscar emoji…',
						searchResultsNone: 'Sin resultados',
						loading: 'Cargando emojis…',
					}}
					onEmojiClick={(data: EmojiClickData) => onSelect(data.emoji)}
				/>
			</div>
		</>
	);
}
