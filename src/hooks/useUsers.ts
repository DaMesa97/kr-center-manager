import { useCallback, useState } from 'react'
import { supabase } from '../supabaseClient'
import { INITIAL_USER_FORM } from '../constants'
import type { CurrentUser, DbProfileRow, DeleteConfirmState, UserFormState } from '../types'
import type { ToastVariant } from '../types'
import type { Session, User } from '@supabase/supabase-js'

type UseUsersParams = {
  pushToast: (msg: string, variant: ToastVariant) => void
  touchSession: () => void
  currentUser: CurrentUser | null
  reloadProfile: (user: User) => Promise<void>
  setDeleteConfirm: (v: DeleteConfirmState | null) => void
  authSession: Session | null
}

export function useUsers({
  pushToast,
  touchSession,
  currentUser,
  reloadProfile,
  setDeleteConfirm,
  authSession,
}: UseUsersParams) {
  const [profilesList, setProfilesList] = useState<DbProfileRow[]>([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [userModalMode, setUserModalMode] = useState<'add' | 'edit'>('add')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [userForm, setUserForm] = useState<UserFormState>(INITIAL_USER_FORM)
  const [userModalSaving, setUserModalSaving] = useState(false)

  const isManager = currentUser?.role === 'manager'

  const fetchProfiles = useCallback(async () => {
    touchSession()
    setProfilesLoading(true)
    const { data, error } = await supabase.from('profiles').select('*').order('full_name')
    if (error) {
      console.error(error)
      pushToast(`Wystąpił błąd: ${error.message}`, 'error')
      setProfilesList([])
    } else {
      setProfilesList(
        (data || []).map((r) => ({
          id: String((r as { id: string }).id),
          first_name: String((r as { first_name?: string }).first_name ?? ''),
          last_name: String((r as { last_name?: string }).last_name ?? ''),
          email: String((r as { email?: string }).email ?? ''),
          user_email: String((r as { user_email?: string }).user_email ?? ''),
          full_name: String((r as { full_name?: string }).full_name ?? ''),
          initials: String((r as { initials?: string }).initials ?? ''),
          role: String((r as { role?: string }).role ?? ''),
          department: String((r as { department?: string }).department ?? 'all'),
        })),
      )
    }
    setProfilesLoading(false)
  }, [pushToast, touchSession])

  const openAddUserModal = () => {
    if (!isManager) return
    setUserModalMode('add')
    setEditingProfileId(null)
    setUserForm(INITIAL_USER_FORM)
    setUserModalOpen(true)
  }

  const openEditUserModal = (row: DbProfileRow) => {
    if (!isManager) return
    setUserModalMode('edit')
    setEditingProfileId(row.id)
    setUserForm({
      username: '',
      full_name: row.full_name,
      initials: row.initials.slice(0, 3),
      password: '',
      role:
        row.role === 'manager' ? 'manager' : row.role === 'sprzedawca' ? 'sprzedawca' : 'worker',
      department:
        (row.role === 'manager'
          ? 'all'
          : row.department === 'bastion'
            ? 'bastion'
            : row.department === 'stalowe'
              ? 'stalowe'
              : row.department === 'magazyn'
                ? 'magazyn'
              : 'all') as UserFormState['department'],
    })
    setUserModalOpen(true)
  }

  const closeUserModal = () => {
    if (userModalSaving) return
    setUserModalOpen(false)
    setEditingProfileId(null)
    setUserForm(INITIAL_USER_FORM)
  }

  const handleSaveUser = async () => {
    if (!isManager) return
    const full_name = userForm.full_name.trim()
    const initials = userForm.initials.trim().slice(0, 3)
    if (!full_name || !initials) {
      pushToast('Uzupełnij imię i nazwisko oraz inicjały', 'error')
      return
    }
    if (userModalMode === 'add') {
      const username = userForm.username.trim()
      if (!username) {
        pushToast('Podaj nazwę użytkownika (login)', 'error')
        return
      }
      if (!userForm.password) {
        pushToast('Podaj hasło', 'error')
        return
      }
      const email = `${username}@krcenter.pl`
      setUserModalSaving(true)
      const { data, error } = await supabase.functions.invoke<{
        error?: string
        user?: { id: string }
      }>('manage-users', {
        body: {
          action: 'create',
          email,
          password: userForm.password,
        },
      })
      if (error || (data && typeof data === 'object' && 'error' in data && data.error)) {
        setUserModalSaving(false)
        pushToast(
          (data && typeof data === 'object' && 'error' in data && data.error
            ? String(data.error)
            : null) || error?.message || 'Błąd tworzenia użytkownika',
          'error',
        )
        return
      }
      const userId = data?.user?.id
      if (!userId) {
        setUserModalSaving(false)
        pushToast('Brak identyfikatora użytkownika', 'error')
        return
      }
      const { error: insertError } = await supabase.from('profiles').insert({
        id: userId,
        initials,
        full_name,
        role: userForm.role,
        department: userForm.role === 'manager' ? 'all' : userForm.department,
      })
      if (insertError) {
        await supabase.functions.invoke('manage-users', {
          body: { action: 'delete', user_id: userId },
        })
        setUserModalSaving(false)
        pushToast(`Wystąpił błąd profilu: ${insertError.message}`, 'error')
        return
      }
      setUserModalSaving(false)
      pushToast('Użytkownik został dodany', 'success')
      closeUserModal()
      await fetchProfiles()
      return
    }

    if (!editingProfileId) return
    const wasSelf = editingProfileId === currentUser?.id
    setUserModalSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name,
        initials,
        role: userForm.role,
        department: userForm.role === 'manager' ? 'all' : userForm.department,
      })
      .eq('id', editingProfileId)
    setUserModalSaving(false)
    if (error) {
      pushToast(`Wystąpił błąd: ${error.message}`, 'error')
      return
    }
    pushToast('Profil zaktualizowany', 'success')
    closeUserModal()
    await fetchProfiles()
    if (wasSelf && authSession?.user) {
      await reloadProfile(authSession.user)
    }
  }

  const handleDeleteUserClick = (row: DbProfileRow) => {
    if (!isManager) return
    if (row.id === currentUser?.id) {
      pushToast('Nie możesz usunąć własnego konta', 'error')
      return
    }
    setDeleteConfirm({
      message: `Czy na pewno usunąć użytkownika „${row.full_name}"?`,
      runDelete: async () => {
        const { data, error } = await supabase.functions.invoke<{ error?: string; ok?: boolean }>(
          'manage-users',
          {
            body: { action: 'delete', user_id: row.id },
          },
        )
        if (error) {
          pushToast(error.message || 'Błąd usuwania', 'error')
          return
        }
        if (data && typeof data === 'object' && 'error' in data && data.error) {
          pushToast(String(data.error), 'error')
          return
        }
        pushToast('Użytkownik został usunięty', 'success')
        await fetchProfiles()
      },
    })
  }

  return {
    profilesList,
    setProfilesList,
    profilesLoading,
    setProfilesLoading,
    userModalOpen,
    setUserModalOpen,
    userModalMode,
    setUserModalMode,
    editingProfileId,
    setEditingProfileId,
    userForm,
    setUserForm,
    userModalSaving,
    setUserModalSaving,
    fetchProfiles,
    openAddUserModal,
    openEditUserModal,
    closeUserModal,
    handleSaveUser,
    handleDeleteUserClick,
  }
}
