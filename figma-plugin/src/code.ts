import type { ToCode, ToPanel } from './messages';
import { placeNewFrames, replaceSelection, selectionState, viewerUrl } from './place';

// Plugin code, in Figma's sandbox: opens the panel, tells it whether the selection can take the model, and places what
// it sends. It makes no requests; the panel fetches everything.
figma.showUI(__html__, { width: 360, height: 560, title: 'Depth', themeColors: true });
const post = (message: ToPanel) => figma.ui.postMessage(message);
const sendSelection = () => post({ type: 'selection', ...selectionState(figma.currentPage.selection) });
figma.on('selectionchange', sendSelection);
figma.on('currentpagechange', sendSelection);
sendSelection();

figma.ui.onmessage = async (message: ToCode) => {
  if (message?.type !== 'place') return;
  try {
    const link = viewerUrl(message.heroId);
    if (message.placement === 'New Frame') post({ type: 'placed', placement: message.placement, notes: (await placeNewFrames(message.heroId, message.hero, message.pngs)).notes, link });
    else {
      replaceSelection(message.pngs.model);
      post({ type: 'placed', placement: message.placement, notes: [], link });
    }
  } catch (error) {
    post({ type: 'failed', message: error instanceof Error ? error.message : 'Placing didn’t finish. Try again.' });
  }
};
