import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { Network } from '@/network';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Settings, Users } from 'lucide-react-taro';
import Taro from '@tarojs/taro';

const AdminPage = () => {
  const [maxSlots, setMaxSlots] = useState(10);
  const [registered, setRegistered] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /** 获取当前设备限额 */
  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const res = await Network.request({ url: '/api/auth/max-slots' });
      const data = (res.data as any)?.data || res.data;
      if (typeof data.maxSlots === 'number') {
        setMaxSlots(data.maxSlots);
        setInputValue(String(data.maxSlots));
      }
      if (typeof data.registered === 'number') {
        setRegistered(data.registered);
      }
    } catch (e: any) {
      console.error('获取配置失败', e);
      Taro.showToast({ title: '获取配置失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

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

  /** 返回首页 */
  const goHome = () => {
    Taro.navigateTo({ url: '/pages/index/index' });
  };

  return (
    <View className="flex flex-col h-full bg-gray-50">
      {/* 顶部导航 */}
      <View className="bg-white px-4 py-3 flex flex-row items-center border-b border-gray-100">
        <View className="mr-3" onClick={goHome}>
          <ArrowLeft size={22} color="#333" />
        </View>
        <Text className="block text-lg font-semibold text-gray-900">设备限额管理</Text>
      </View>

      <ScrollView className="flex-1 px-4 py-4">
        {/* 当前状态卡片 */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <View className="flex flex-row items-center justify-between">
              <View className="flex flex-row items-center gap-2">
                <Users size={20} color="#6b7280" />
                <View>
                  <Text className="block text-xs text-gray-500">当前已注册设备</Text>
                  <Text className="block text-2xl font-bold text-gray-900">{loading ? '...' : registered}</Text>
                </View>
              </View>
              <View className="h-10 w-px bg-gray-200" />
              <View className="flex flex-row items-center gap-2">
                <Settings size={20} color="#6b7280" />
                <View className="text-right">
                  <Text className="block text-xs text-gray-500">当前限额</Text>
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