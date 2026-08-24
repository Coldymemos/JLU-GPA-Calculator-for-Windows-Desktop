import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined
} from '@ant-design/icons';
import { Alert, Button, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { ArchiveSummary } from '../../infrastructure/persistence';

interface Props {
  open: boolean;
  archives: ArchiveSummary[];
  activeArchiveId: string;
  onClose: () => void;
  onSwitch: (id: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (archive: ArchiveSummary) => void;
}

export function ArchiveDialog({
  open,
  archives,
  activeArchiveId,
  onClose,
  onSwitch,
  onCreate,
  onRename,
  onDelete
}: Props) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="成绩档案"
      footer={null}
      width={620}
      onCancel={onClose}
      afterClose={() => {
        setNewName('');
        setEditingId(undefined);
        setEditingName('');
      }}
    >
      <Alert
        showIcon
        type="info"
        message="课程、计算规则和设置按档案独立保存；数据库备份仍包含全部档案。"
      />
      <Space.Compact block className="archive-create-row">
        <Input
          value={newName}
          maxLength={80}
          placeholder="新档案名称，例如 2025–2026 学年"
          onChange={(event) => setNewName(event.target.value)}
          onPressEnter={() => {
            const name = newName.trim();
            if (!name || busy) return;
            void run(async () => {
              await onCreate(name);
              setNewName('');
            }).catch(() => undefined);
          }}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={busy}
          disabled={!newName.trim()}
          onClick={() => {
            const name = newName.trim();
            if (!name) return;
            void run(async () => {
              await onCreate(name);
              setNewName('');
            }).catch(() => undefined);
          }}
        >
          新建
        </Button>
      </Space.Compact>

      <List
        className="archive-list"
        dataSource={archives}
        locale={{ emptyText: '暂无档案' }}
        renderItem={(archive) => {
          const active = archive.id === activeArchiveId;
          const editing = archive.id === editingId;
          return (
            <List.Item
              actions={
                editing
                  ? [
                      <Button
                        key="save"
                        type="text"
                        aria-label="保存档案名称"
                        icon={<CheckOutlined />}
                        disabled={!editingName.trim() || busy}
                        onClick={() => {
                          void run(async () => {
                            await onRename(archive.id, editingName.trim());
                            setEditingId(undefined);
                          }).catch(() => undefined);
                        }}
                      />,
                      <Button
                        key="cancel"
                        type="text"
                        aria-label="取消重命名"
                        icon={<CloseOutlined />}
                        onClick={() => setEditingId(undefined)}
                      />
                    ]
                  : [
                      !active && (
                        <Button
                          key="switch"
                          type="link"
                          disabled={busy}
                          onClick={() => {
                            void run(() => onSwitch(archive.id))
                              .then(onClose)
                              .catch(() => undefined);
                          }}
                        >
                          切换
                        </Button>
                      ),
                      <Button
                        key="rename"
                        type="text"
                        aria-label={`重命名 ${archive.name}`}
                        icon={<EditOutlined />}
                        disabled={busy}
                        onClick={() => {
                          setEditingId(archive.id);
                          setEditingName(archive.name);
                        }}
                      />,
                      <Button
                        key="delete"
                        type="text"
                        danger
                        aria-label={`删除 ${archive.name}`}
                        icon={<DeleteOutlined />}
                        disabled={archives.length <= 1 || busy}
                        onClick={() => onDelete(archive)}
                      />
                    ].filter(Boolean)
              }
            >
              <List.Item.Meta
                title={
                  editing ? (
                    <Input
                      value={editingName}
                      maxLength={80}
                      autoFocus
                      onChange={(event) => setEditingName(event.target.value)}
                    />
                  ) : (
                    <Space>
                      <Typography.Text strong>{archive.name}</Typography.Text>
                      {active && <Tag color="red">当前</Tag>}
                    </Space>
                  )
                }
                description={`${archive.courseCount} 门课程 · 创建于 ${archive.createdAt}`}
              />
            </List.Item>
          );
        }}
      />
    </Modal>
  );
}
