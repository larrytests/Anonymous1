import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Reliever } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

interface RelieverCardProps {
  reliever: Reliever;
  onConnect: () => void;
}

export default function RelieverCard({ reliever, onConnect }: RelieverCardProps) {
  // Safe formatting of the lastActive timestamp
  const formatLastActive = () => {
    try {
      const timestamp = reliever.lastActive instanceof Date 
        ? reliever.lastActive 
        : new Date(reliever.lastActive);
      return formatDistanceToNow(timestamp, { addSuffix: true });
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'recently';
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row gap-4 items-center">
        <Avatar className="w-12 h-12">
          <AvatarImage src={reliever.avatarUrl} alt={reliever.displayName} />
          <AvatarFallback>{reliever.displayName[0]}</AvatarFallback>
        </Avatar>
        <div>
          <h3 className="font-semibold">{reliever.displayName}</h3>
          <p className="text-sm text-muted-foreground">
            Active {formatLastActive()}
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        <p className="text-sm text-gray-600 mb-4">{reliever.bio}</p>
        <div className="flex flex-wrap gap-2">
          {reliever.skills.map((skill, index) => (
            <Badge key={index} variant="secondary">{skill}</Badge>
          ))}
        </div>
      </CardContent>

      <CardFooter className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${reliever.isAvailable ? 'bg-[#57F287]' : 'bg-[#ED4245]'}`} />
          <span className="text-sm">{reliever.isAvailable ? 'Available' : 'Busy'}</span>
        </div>
        <Button onClick={onConnect} disabled={!reliever.isAvailable}>
          Connect
        </Button>
      </CardFooter>
    </Card>
  );
}