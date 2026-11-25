import React, { useCallback, useEffect, useRef } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/alert-dialog/alert-dialog';
import type { AlertDialogProps } from '@radix-ui/react-alert-dialog';
import { useAlert } from '@/context/alert-context/alert-context';

export interface BaseAlertDialogProps {
    title: string;
    description?: string;
    actionLabel?: string;
    closeLabel?: string;
    onAction?: () => void;
    dialog?: AlertDialogProps;
    onClose?: () => void;
    content?: React.ReactNode;
}

export const BaseAlertDialog: React.FC<BaseAlertDialogProps> = ({
    title,
    description,
    actionLabel,
    closeLabel,
    onAction,
    dialog,
    content,
    onClose,
}) => {
    const { closeAlert } = useAlert();

    // Un seul des deux rappels (onAction ou onClose) est exécuté par ouverture :
    // Radix rappelle onOpenChange(false) après un clic sur Action ou Annuler.
    const handledRef = useRef(false);
    const isOpen = dialog?.open;
    useEffect(() => {
        if (isOpen) {
            handledRef.current = false;
        }
    }, [isOpen]);

    const closeAlertHandler = useCallback(() => {
        if (!handledRef.current) {
            handledRef.current = true;
            onClose?.();
        }
        closeAlert();
    }, [onClose, closeAlert]);

    const alertHandler = useCallback(() => {
        if (!handledRef.current) {
            handledRef.current = true;
            onAction?.();
        }
        closeAlert();
    }, [onAction, closeAlert]);

    return (
        <AlertDialog
            {...dialog}
            onOpenChange={(open) => {
                if (!open) {
                    // Échap ou clic hors de la boîte : équivaut à annuler.
                    closeAlertHandler();
                }
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    {description && (
                        <AlertDialogDescription>
                            {description}
                        </AlertDialogDescription>
                    )}
                    {content}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {closeLabel && (
                        <AlertDialogCancel onClick={closeAlertHandler}>
                            {closeLabel}
                        </AlertDialogCancel>
                    )}
                    {actionLabel && (
                        <AlertDialogAction onClick={alertHandler}>
                            {actionLabel}
                        </AlertDialogAction>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
