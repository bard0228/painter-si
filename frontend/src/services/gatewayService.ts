import { doc, onSnapshot } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../config/firebase';
import type { BackendGatewayHealth, GatewayConfig } from '../types/domain';

export function subscribeGatewayConfig(
  onData: (config: GatewayConfig | null) => void,
  onError: (err: Error) => void
): () => void {
  if (!db) {
    onData(null);
    return () => {};
  }

  const ref = doc(db, 'system', 'gateway');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(snap.data() as GatewayConfig);
    },
    (err) => onError(err)
  );
}

export async function checkBackendGatewayHealth(
  gatewayUrl: string,
  user: User
): Promise<BackendGatewayHealth> {
  const cleanUrl = gatewayUrl.replace(/\/+$/, '');
  const idToken = await user.getIdToken(true);

  const response = await fetch(`${cleanUrl}/health`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`);
  }

  return (await response.json()) as BackendGatewayHealth;
}
