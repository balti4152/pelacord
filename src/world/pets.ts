import {getProfile, updateProfile} from '@/world/core';
import type {PetId} from '@/world/petCatalog';

export const SPHERE_PRICE = 30;
export function equipPet(pet: PetId | null): void {
	const profile = getProfile();
	if (pet === profile.equippedPet || (pet !== null && !profile.pets[pet])) return;
	updateProfile({equippedPet: pet});
}

export function buyCaptureSphere(): boolean {
	const profile = getProfile();
	if (profile.coins < SPHERE_PRICE) return false;
	updateProfile({coins: profile.coins - SPHERE_PRICE, captureSpheres: profile.captureSpheres + 1});
	return true;
}

export function recordPetCapture(id: PetId): boolean {
	const profile = getProfile();
	if (profile.captureSpheres < 1) return false;
	updateProfile({captureSpheres: profile.captureSpheres - 1, pets: {...profile.pets, [id]: (profile.pets[id] ?? 0) + 1}});
	return true;
}
