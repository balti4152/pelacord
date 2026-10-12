import {type FormEvent, useState} from 'react';
import logo from '@/assets/logo.png';
import {confirmName, getIdentity} from '@/lib/identity';
import {useStore} from '@/state/store';

/** Pantalla de bienvenida: se pide el nombre una sola vez y listo. */
export function Onboarding(): JSX.Element {
	const {updateProfile} = useStore();
	const [name, setName] = useState('');

	function submit(event: FormEvent): void {
		event.preventDefault();
		const identity = getIdentity();
		const next = confirmName(identity, name);
		updateProfile({name: next.name});
	}

	return (
		<div className="onboarding">
			<form className="onboarding-card" onSubmit={submit}>
				<img className="onboarding-logo-img" src={logo} alt="Pelacord" />
				<h1>Bienvenido a Pelacord</h1>
				<input
					className="input"
					placeholder="Tu nombre"
					value={name}
					autoFocus
					maxLength={32}
					onChange={(event) => setName(event.target.value)}
				/>
				<button type="submit" className="button primary full" disabled={!name.trim()}>
					Entrar
				</button>
			</form>
		</div>
	);
}
