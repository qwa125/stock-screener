import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { Network } from '@/network';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Settings, Users, Trash2 } from 'lucide-react-taro';
import Taro from '@tarojs/taro';

const API_TIMEOUT = 15000; // 15s 超时，避免网络挂起

/** 带超时的 Network.request 封装 */
const timeoutFetch = async (url: string, options?: any) => {
  const res = await Promise.race([
    Network.request({ url, ...options }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('请求超时，请检查网络连接')), API_TIMEOUT)
    ),
  ]);
  return res;
};

interface DeviceInfo {
  index: number;
  fingerprint: string;
  displayName: string;
  firstSeen: number;
  lastSeen: number;
  firstSeenStr: string;
  lastSeenStr: string;
}

const AdminPage = () => {
  const [maxSlots, setMaxSlots] = useState(10);
  const [registered, setRegistered] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  /** 获取当前设备限额和列表 */
  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [configRes, devicesRes] = await Promise.all([
        timeoutFetch('/api/auth/max-slots'),
        timeoutFetch('/api/auth/devices'),
      ]);

      // 解析配置
      const configData = (configRes.data as any)?.data || configRes.data;
      if (typeof configData.maxSlots === 'number') {
        setMaxSlots(configData.maxSlots);
        setInputValue(String(configData.maxSlots));
      }
      if (typeof configData.registered === 'number') {
        setRegistered(configData.registered);
      }

      // 解析设备列表
      const devData = (devicesRes.data as any)?.data || devicesRes.data;
      if (Array.isArray(devData?.devices)) {
        setDevices(devData.devices);
        if (typeof devData.total === 'number') setRegistered(devData.total);
      }
    } catch (e: any) {
      console.error('获取数据失败', e);
      Taro.showToast({ title: '获取数据失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** 保存设备限额 */
  const handleSave = async () => {
    const v = parseInt(inputValue, 10);
    if (Number.isNaN(v) || v < 1 || v > 100) {
      Taro.showToast({ title: '请输入 1~100 之间的数字', icon: 'none' });
      return;
    }
    try {
      setSaving(true);
      const res = await Network.request({
        url: '/api/auth/max-slots',
        method: 'PUT',
        data: { maxSlots: v },
      });
      const data = (res.data as any)?.data || res.data;
      if (data.maxSlots) {
        setMaxSlots(data.maxSlots);
        setInputValue(String(data.maxSlots));
      }
      Taro.showToast({ title: `设备数已设为 ${v}`, icon: 'success' });
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '设置失败', icon: 'none' });
    } finally {
      setSaving(false);
    }
  };

  /** 删除单个设备 */
  const handleDeleteDevice = async (index: number) => {
    try {
      setDeletingIndex(index);
      const res = await Network.request({
        url: `/api/auth/devices/${index}`,
        method: 'DELETE',
      });
      const data = (res.data as any)?.data || res.data;
      if (data?.registered !== undefined) setRegistered(data.registered);
      setDevices(prev => prev.filter(d => d.index !== index));
      Taro.showToast({ title: '设备已删除', icon: 'success' });
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '删除失败', icon: 'none' });
    } finally {
      setDeletingIndex(null);
    }
  };

  /** 清空所有设备 */
  const handleClearAll = async () => {
    try {
      setClearing(true);
      const res = await Network.request({
        url: '/api/auth/devices',
        method: 'DELETE',
      });
      const data = (res.data as any)?.data || res.data;
      if (data?.registered !== undefined) setRegistered(data.registered);
      setDevices([]);
      Taro.showToast({ title: '已清空所有设备', icon: 'success' });
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '清空失败', icon: 'none' });
    } finally {
      setClearing(false);
    }
  };

  /** 返回首页 */
  const goHome = () => {
    Taro.navigateTo({ url: '/pages/index/index' });
  };

  /** 格式化时间 */
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <View className="flex flex-col h-full bg-gray-50">
      {/* 顶部导航 */}
      <View className="bg-white px-4 py-3 flex flex-row items-center border-b border-gray-100">
        <View className="mr-3" onClick={goHome}>
          <ArrowLeft size={22} color="#333" />
        </View>
        <Text className="block text-lg font-semibold text-gray-900">设备管理</Text>
      </View>

      <ScrollView className="flex-1 px-4 py-4">
        {/* 当前状态卡片 */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <View className="flex flex-row items-center justify-between">
              <View className="flex flex-row items-center gap-2">
                <Users size={20} color="#6b7280" />
                <View>
                  <Text className="block text-xs text-gray-500">已注册设备</Text>
                  <Text className="block text-2xl font-bold text-gray-900">{loading ? '...' : registered}</Text>
                </View>
              </View>
              <View className="h-10 w-px bg-gray-200" />
              <View className="flex flex-row items-center gap-2">
                <Settings size={20} color="#6b7280" />
                <View className="text-right">
                  <Text className="block text-xs text-gray-500">设备限额</Text>
                  <Text className="block text-2xl font-bold text-blue-600">{loading ? '...' : maxSlots}</Text>
                </View>
              </View>
            </View>
            {/* 使用率进度条 */}
            {!loading && (
              <View className="mt-3">
                <View className="flex flex-row justify-between mb-1">
                  <Text className="block text-xs text-gray-400">使用率</Text>
                  <Text className="block text-xs text-gray-400">{Math.round((registered / maxSlots) * 100)}%</Text>
                </View>
                <View className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <View
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (registered / maxSlots) * 100)}%`,
                      backgroundColor: (registered / maxSlots) > 0.8 ? '#ef4444' : (registered / maxSlots) > 0.5 ? '#eab308' : '#22c55e',
                    }}
                  />
                </View>
              </View>
            )}
          </CardContent>
        </Card>

        {/* 已注册设备列表 */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <View className="flex flex-row items-center justify-between mb-3">
              <Text className="block text-sm font-medium text-gray-700">设备列表</Text>
              {devices.length > 0 && (
                <Button
                  className="bg-red-50 border border-red-200 px-3 py-1 rounded-lg"
                  onClick={() => {
                    Taro.showModal({
                      title: '确认清空',
                      content: `确定要清空全部 ${devices.length} 个已注册设备吗？`,
                      success: (res) => {
                        if (res.confirm) handleClearAll();
                      },
                    });
                  }}
                  disabled={clearing}
                >
                  <Trash2 size={14} color="#ef4444" />
                  <Text className="block text-xs text-red-500 ml-1">清空全部</Text>
                </Button>
              )}
            </View>

            {loading ? (
              <View className="py-8">
                <Text className="block text-center text-sm text-gray-400">加载中...</Text>
              </View>
            ) : devices.length === 0 ? (
              <View className="py-8 flex flex-col items-center">
                <Users size={32} color="#d1d5db" />
                <Text className="block text-sm text-gray-400 mt-2">暂无已注册设备</Text>
              </View>
            ) : (
              <View className="space-y-2">
                {/* 表头 */}
                <View className="flex flex-row items-center px-3 py-2 bg-gray-50 rounded-lg">
                  <Text className="block text-xs text-gray-400 w-8 text-center">#</Text>
                  <Text className="block text-xs text-gray-400 flex-1">设备标识</Text>
                  <Text className="block text-xs text-gray-400 w-16 text-right">首次访问</Text>
                  <Text className="block text-xs text-gray-400 w-16 text-right mr-10">最近访问</Text>
                </View>
                {/* 设备行 */}
                {devices.map((device) => (
                  <View
                    key={device.index}
                    className="flex flex-row items-center px-3 py-3 bg-white border border-gray-100 rounded-lg"
                  >
                    <Text className="block text-xs text-gray-500 w-8 text-center">{device.index + 1}</Text>
                    <View className="flex-1 min-w-0">
                      <Text className="block text-xs font-medium text-gray-700 truncate">{device.displayName}</Text>
                    </View>
                    <Text className="block text-xs text-gray-400 w-16 text-right">{formatTime(device.firstSeen)}</Text>
                    <Text className="block text-xs text-gray-400 w-16 text-right mr-2">{formatTime(device.lastSeen)}</Text>
                    <Button
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-red-50"
                      onClick={() => {
                        Taro.showModal({
                          title: '确认删除',
                          content: `确定要删除设备 #${device.index + 1} 吗？`,
                          success: (res) => {
                            if (res.confirm) handleDeleteDevice(device.index);
                          },
                        });
                      }}
                      disabled={deletingIndex === device.index}
                    >
                      <Trash2 size={14} color={deletingIndex === device.index ? '#9ca3af' : '#ef4444'} />
                    </Button>
                  </View>
                ))}
              </View>
            )}
          </CardContent>
        </Card>

        {/* 设置卡片 */}
        <Card>
          <CardContent className="p-4">
            <Text className="block text-sm font-medium text-gray-700 mb-1">修改设备限额</Text>
            <Text className="block text-xs text-gray-400 mb-3">设置允许的最大访问设备数量（1~100）</Text>
            <View className="flex flex-row items-center gap-3">
              <Input
                className="flex-1"
                type="number"
                value={inputValue}
                onInput={(e) => setInputValue(e.detail.value)}
                placeholder="输入 1~100"
              />
              <Button
                className="bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium"
                onClick={handleSave}
                disabled={saving}
              >
                <Text className="block text-sm font-medium">{saving ? '保存中...' : '确认修改'}</Text>
              </Button>
            </View>
          </CardContent>
        </Card>
      </ScrollView>
    </View>
  );
};

export default AdminPage;