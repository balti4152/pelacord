import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {CatalogItem, Look} from '@/world/core';
import {attachProductPreview, PRODUCT_PREVIEW_SIZE} from '@/world/productPreviews';

export function ProductPreview({item, avatarUrl, look, color, fallback, className = ''}: {
	item: CatalogItem;
	avatarUrl: string;
	look: Look;
	color?: string;
	fallback: ReactNode;
	className?: string;
}): JSX.Element {
	const ref = useRef<HTMLCanvasElement>(null);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		setReady(false);
		if (!ref.current) return;
		return attachProductPreview(ref.current, item, avatarUrl, look, color, () => setReady(true));
	}, [item, avatarUrl, look, color]);
	return (
		<span className={'t-product-preview ' + className} aria-hidden="true" data-preview-ready={ready}>
			{!ready ? <span className="t-product-fallback">{fallback}</span> : null}
			<canvas ref={ref} width={PRODUCT_PREVIEW_SIZE} height={PRODUCT_PREVIEW_SIZE} />
		</span>
	);
}
