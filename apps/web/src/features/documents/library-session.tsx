import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useRef } from "react";

type DocumentRef = { id: string };
export type OnDocumentEffect = (
	effect: "trash" | "restore" | "purge",
	documents?: readonly DocumentRef[],
) => void | Promise<void>;

type DocumentLibrarySession = {
	registerEffect: (play: OnDocumentEffect) => () => void;
	playEffect: OnDocumentEffect;
};

export const DocumentLibraryContext = createContext<DocumentLibrarySession | null>(null);
type DocumentLibraryProviderProps = { children: ReactNode };

/** Lives with the account-keyed dashboard shell, across Documents/Trash navigation. */
export function DocumentLibraryProvider({ children }: DocumentLibraryProviderProps) {
	const effect = useRef<OnDocumentEffect | undefined>(undefined);
	const registerEffect = useCallback((play: OnDocumentEffect) => {
		effect.current = play;
		return () => {
			if (effect.current === play) effect.current = undefined;
		};
	}, []);
	const playEffect = useCallback<OnDocumentEffect>((...args) => effect.current?.(...args), []);
	return <DocumentLibraryContext value={{ registerEffect, playEffect }}>{children}</DocumentLibraryContext>;
}

/** Undo toasts outlive their originating page; animate the currently mounted collection. */
export function useDocumentEffect() {
	const play = useContext(DocumentLibraryContext)?.playEffect;
	return useCallback<OnDocumentEffect>((...args) => play?.(...args), [play]);
}
