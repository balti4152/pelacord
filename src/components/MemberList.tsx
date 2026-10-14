import {useState} from 'react';
import {Avatar, Icon} from '@/components/primitives';
import {ProfilePopover, UserContextMenu, type UserLike, userFromMember} from '@/components/UserMenu';
import {useStore} from '@/state/store';

export function MemberList(): JSX.Element {
	const {state} = useStore();
	const [menu, setMenu] = useState<{user: UserLike; x: number; y: number} | null>(null);
	const [profile, setProfile] = useState<UserLike | null>(null);

	// La entrada propia siempre va con el perfil fresco (si no, el popover mostraba datos viejos).
	const members = state.members.map((member) => (member.id === state.me.id ? state.me : member));

	const groups: Array<{label: string; members: typeof state.members}> = [
		{label: 'En línea', members: members.filter((m) => m.presence !== 'offline')},
		{label: 'Desconectados', members: members.filter((m) => m.presence === 'offline')},
	];

	return (
		<aside className="members" data-flx="member-list">
			{/* Franja de arriba: la dejan libre los botones de la ventana (minimizar/maximizar/cerrar),
			    que Windows dibuja encima del contenido. También sirve para arrastrar la ventana. */}
			<div className="members-titlebar" aria-hidden="true" />
			<div className="members-scroll">
				{groups.map((group) =>
					group.members.length === 0 ? null : (
						<div key={group.label}>
							<div className="members-group-header">
								{group.label} - {group.members.length}
							</div>
							{group.members.map((member) => (
								<div
									key={member.id}
									className={`member${member.presence === 'offline' ? ' is-offline' : ''}`}
									role="button"
									tabIndex={0}
									onClick={() => setProfile(userFromMember(member))}
									onContextMenu={(event) => {
										event.preventDefault();
										setMenu({user: userFromMember(member), x: event.clientX, y: event.clientY});
									}}>
									<Avatar member={member} size={32} showStatus statusBorderColor="var(--background-secondary)" />
									<div className="member-info">
										<div className="member-name" style={member.isBot ? {color: 'var(--brand-primary-light)'} : undefined}>
											{member.name}
											{member.isBot ? (
												<span
													style={{
														marginLeft: '0.375rem',
														padding: '0 0.25rem',
														borderRadius: '3px',
														backgroundColor: 'var(--brand-primary)',
														color: 'var(--text-on-brand-primary)',
														fontSize: '0.625rem',
														fontWeight: 600,
														verticalAlign: 'middle',
													}}>
													BOT
												</span>
											) : null}
										</div>
										{member.status ? <div className="member-sub">{member.status}</div> : null}
									</div>
								</div>
							))}
						</div>
					),
				)}
				<div style={{padding: '1rem 0.5rem 0', color: 'var(--text-tertiary)', fontSize: '0.75rem'}}>
					<Icon name="members" size={14} />
				</div>
			</div>

			{menu ? (
				<UserContextMenu
					user={menu.user}
					x={menu.x}
					y={menu.y}
					canVolume={false}
					onClose={() => setMenu(null)}
					onViewProfile={() => setProfile(menu.user)}
				/>
			) : null}
			{profile ? <ProfilePopover user={profile} canVolume={false} onClose={() => setProfile(null)} /> : null}
		</aside>
	);
}
